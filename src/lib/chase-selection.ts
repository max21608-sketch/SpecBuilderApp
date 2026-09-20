// WHICH QUESTIONS A CHASE ARRIVES TICKED.
//
// ============================================================================
// WHY THIS IS A FUNCTION AND NOT A LOOP INSIDE THE SCREEN
//
// The drafts screen seeded its default selection ONCE, in `load()`, behind a
// `seeded` ref — every spec-field question not awaiting a reply, across every
// contact. Max, watching it on the real project (FIU 15): *"it's still
// selecting all of them, when in fact it should have just selected [the
// four]."* The reading was already right on screen — a red dot is `to_quote`
// and a grey one is `later` — and the default ignored it.
//
// The default now has to be computed at TWO moments, which is what makes it a
// function rather than a tighter loop in the same place: on first load, and
// again whenever the contact changes. A chase is written to ONE person, so a
// selection belongs to a recipient; carrying Hayley's ticks onto Claire's
// email is a wrong default nobody would notice until it was sent. Seeding once
// and filtering by tier inside that one loop would leave exactly that bug, and
// the footer — which counts from these same inputs — would then claim a
// preselection it had not made.
//
// NOTHING HERE IS REMEMBERED. Changing contact and changing back re-seeds, and
// does not restore what was ticked the first time. A remembered selection per
// contact is a third state to keep in step with the live question list, and
// the plan asks for no memory.
//
// ---- THREE RULES, AND EACH IS A DECISION ALREADY TAKEN --------------------
//
//   * THE TIER IS READ OFF THE PAYLOAD, NEVER RE-DERIVED. `questionTier` is
//     the single implementation and it runs on the server; the client is told
//     the answer and a request that tries to SET one is a 400. A second
//     reading here is how the ticks and the email's own two headings start
//     disagreeing about what blocks a quote.
//
//   * READINESS IS NEVER DEFAULTED IN. 408 of the 728 seeded requirements are
//     readiness questions and they include deposit status and COM payment
//     plan — Ben Whistler's own commercial checklist, which can be chosen but
//     never by accident. Decision 19, unchanged.
//
//   * A QUESTION ALREADY AWAITING A REPLY IS NOT ASKED AGAIN by default.
//     Unchanged, and the reason the screen keeps a Waiting toggle at all.
//
// A question with NO TIER is excluded from both counts. That is a record with
// no level on a category Matthew's matrix does not cover, and the screen
// already lists it as a blocker with a level picker on it: a default cannot
// decide what only a person can, and putting it in the "also outstanding"
// number would quietly say it had been considered.
//
// A FILTER NEVER REACHES ANY OF THIS. The tier dropdown, the search and the
// waiting toggle narrow what is LISTED; the selection is the truth. That rule
// predates this file and is asserted in `tests/components/chase-question-table.test.tsx`.
// ============================================================================
import type { QuestionTier } from "@/lib/tgq";

/**
 * The shape this file needs from a question. Structural on purpose, like
 * `GroupableQuestion`: the screen's own type carries the prompt, the BWS field
 * and the rest, and satisfies this without being imported here.
 */
export type SelectableQuestion = {
  recordId: string;
  requirementId: string;
  requirementKind: "spec_field" | "readiness";
  /** The server's reading. Null where the record has no level to read it at. */
  tier: QuestionTier | null;
  /** A draft that already asked it. Anything non-null means somebody is waiting. */
  waiting: unknown | null;
  /** Who this question would be asked of. */
  contactId: string;
};

/**
 * The key a selection is held under, defined ONCE.
 *
 * The page and the table both build `${recordId}:${requirementId}`, and a
 * selection is a set of these — two spellings of it is a screen whose ticks
 * and whose draft describe different questions.
 */
export const selectionKey = (recordId: string, requirementId: string) => `${recordId}:${requirementId}`;

/** Asked of this person, still worth asking, and a specification question. */
function chaseable(question: SelectableQuestion, contactId: string): boolean {
  if (!contactId) return false;
  if (question.contactId !== contactId) return false;
  if (question.requirementKind !== "spec_field") return false;
  if (question.waiting) return false;
  return true;
}

/**
 * Exactly the questions that block a quote for the chosen contact.
 *
 * NO CONTACT CHOSEN IS AN EMPTY SET, not "everybody's". The Everyone tab lists
 * several people's questions at once and one press would draft an email to
 * each of them; the screen says in words that nothing is preselected until a
 * person is chosen, which is a state somebody can act on where a silent
 * multi-recipient default is not.
 */
export function defaultSelection(questions: readonly SelectableQuestion[], contactId: string): Set<string> {
  const out = new Set<string>();
  for (const question of questions) {
    if (!chaseable(question, contactId)) continue;
    if (question.tier !== "to_quote") continue;
    out.add(selectionKey(question.recordId, question.requirementId));
  }
  return out;
}

export type SelectionSummary = {
  /** False on the Everyone tab, where nothing is preselected. */
  contactChosen: boolean;
  /** How many `to_quote` questions `defaultSelection` ticked. */
  preselected: number;
  /** How many `later` ones it deliberately left. */
  alsoOutstanding: number;
};

/**
 * The same reading, as the numbers the footer prints.
 *
 * ONE FUNCTION, TWO OUTPUTS, so the words and the ticks cannot disagree: a
 * footer counting its own way is how a screen comes to say "4 preselected"
 * over three ticked boxes. Both halves run the same `chaseable` test, so a
 * question excluded from the preselection for being readiness, or awaiting a
 * reply, or somebody else's, is not counted as "also outstanding" either.
 */
export function selectionSummary(questions: readonly SelectableQuestion[], contactId: string): SelectionSummary {
  let preselected = 0;
  let alsoOutstanding = 0;
  for (const question of questions) {
    if (!chaseable(question, contactId)) continue;
    if (question.tier === "to_quote") preselected += 1;
    else if (question.tier === "later") alsoOutstanding += 1;
  }
  return { contactChosen: Boolean(contactId), preselected, alsoOutstanding };
}
