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
//   * ONLY A CLIENT QUESTION IS DEFAULTED IN (0062, decision D). It was
//     "readiness is never defaulted in" (decision 19): 408 of the 728 seeded
//     requirements are readiness questions, including deposit status and COM
//     payment plan. The audience says it better — "Assembly guide" fills a
//     BWS field and is ours, "Floor plans" has none and is the client's — and
//     0062 seeded it from the kind, so the two read alike until seed 0015.
//
//   * A QUESTION ALREADY AWAITING A REPLY IS NOT ASKED AGAIN by default.
//     Unchanged, and the reason the screen keeps a Waiting toggle at all.
//
//   * A QUESTION A PERSON SENT TO THE CLIENT IS TICKED (chase review A3,
//     2026-11-21). "Ask the client" on the fill-in screen moves a CAM question
//     to the chase for one project, and every CAM question is project-wide —
//     which is never preselected — so "Moved to the chase" put it in no chase.
//     A person's explicit decision outranks that default, at either tier
//     (`movedToClient`); the waiting rule still holds it back.
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
import { isClientQuestion, isProjectWideQuestion } from "@/lib/chase-grouping";
import type { QuestionAudience } from "@/lib/spec-vocab";

/**
 * The shape this file needs from a question. Structural on purpose, like
 * `GroupableQuestion`: the screen's own type carries the prompt, the BWS field
 * and the rest, and satisfies this without being imported here.
 */
export type SelectableQuestion = {
  recordId: string;
  requirementId: string;
  requirementKind: "spec_field" | "readiness";
  /** Who the question is for (0062), after this project's routes. Only a client question is preselected. */
  audience: QuestionAudience;
  /** Who the cheat sheet says answers it. Differs from `audience` only where a person moved it. */
  seedAudience: QuestionAudience;
  /** The server's reading. Null where the record has no level to read it at. */
  tier: QuestionTier | null;
  /** The cheat sheet's section. A project-wide question is answered once on the project, never asked per item. */
  section: string | null;
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

/**
 * Moved to the client by a person on this project ("Ask the client", 0062).
 * The project's route is the only thing that makes the two audiences differ.
 */
export function movedToClient(question: Pick<SelectableQuestion, "audience" | "seedAudience">): boolean {
  return question.audience === "client" && question.seedAudience !== "client";
}

/** Asked of this person, still worth asking, and a CLIENT question (0062, decision D). */
function chaseable(question: SelectableQuestion, contactId: string): boolean {
  if (!contactId) return false;
  if (question.contactId !== contactId) return false;
  if (!isClientQuestion(question)) return false;
  // A PERSON'S DECISION OUTRANKS THE PROJECT-WIDE DEFAULT (review A3).
  if (movedToClient(question)) return !question.waiting;
  // ANSWERED ONCE, ON THE PROJECT (Max, 2026-10-12). Preselecting "Is access
  // ok?" on thirty items would ask a designer one question thirty times — and
  // the record's "Chase the n" button, which counts `inChaseAsk`, would land on
  // a screen ticking more than it said. Still listed, still tickable by hand.
  if (isProjectWideQuestion(question)) return false;
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
    // Moved by a person: ticked at either tier, because they asked for it.
    if (question.tier !== "to_quote" && !movedToClient(question)) continue;
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
  /**
   * THE THIRD BUCKET, AND THE REASON THE FOOTER USED TO NOT ADD UP.
   *
   * A question already asked and awaiting a reply is not asked again by
   * default — `chaseable` refuses it — but the LINE still counts it, because
   * it is still outstanding. On the sandbox demo project (found-in-use
   * 2026-09-20) that read as the lines' to-quote column summing to 71 beside a
   * button saying 70, with nothing on screen naming the one. Both numbers were
   * right and the footer named only two of the three sets.
   *
   * Counted over BOTH tiers, so the three numbers partition every tiered
   * specification question this contact owes — which is what makes the
   * arithmetic close rather than nearly close.
   *
   * It changes NOTHING about what is selected. The Waiting toggle is still the
   * only way one of these is asked again, and a filter narrows what is LISTED,
   * never what is ASKED.
   */
  awaitingReply: number;
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
  let awaitingReply = 0;
  for (const question of questions) {
    // The waiting ones fail `chaseable` for that reason alone, so they are
    // counted against the SAME other three tests rather than a looser set.
    if (question.waiting && chaseable({ ...question, waiting: null }, contactId)) {
      if (question.tier === "to_quote" || question.tier === "later" || movedToClient(question)) awaitingReply += 1;
      continue;
    }
    if (!chaseable(question, contactId)) continue;
    if (question.tier === "to_quote" || movedToClient(question)) preselected += 1;
    else if (question.tier === "later") alsoOutstanding += 1;
  }
  return { contactChosen: Boolean(contactId), preselected, alsoOutstanding, awaitingReply };
}
