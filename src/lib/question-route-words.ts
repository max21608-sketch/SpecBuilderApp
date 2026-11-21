// What the fill-in screen says after "Ask the client" or "Put it back" (0062,
// decision D). Pure, so the sentence is tested rather than read off a screen.
//
// IT SAYS WHERE THE QUESTION WENT, TRULY (chase review A3, 2026-11-21). It
// read "Moved to the chase" while the chase ticked nothing: every CAM question
// is project-wide, and a project-wide question was never preselected. The
// chase now ticks a moved question for the designer of each item that asks it
// (`movedToClient` in `chase-selection.ts`), so the sentence names who that
// is — and says so when an item has nobody to ask, because then the question
// sits under the chase screen's "Nobody assigned" and reaches no email.

export type ChasedTo = { contactName: string; items: number };

export type QuestionRouteOutcome = {
  audience: "client" | "cam" | "in_house";
  /** Present on a move to the client: whose next chase lists and ticks it. */
  chasedTo?: ChasedTo[];
  /** Items asking it with no designer contact to ask. */
  unassigned?: number;
};

const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

export function questionRouteSentence(askClient: boolean, outcome: QuestionRouteOutcome): string {
  if (!askClient) return "Put back: on this project it is ours to answer again, and no chase will ask it.";
  const chasedTo = outcome.chasedTo ?? [];
  const unassigned = outcome.unassigned ?? 0;
  const head = "Moved to the client on this project.";
  const listed =
    chasedTo.length > 0
      ? ` The next chase to ${chasedTo.map((entry) => `${entry.contactName} (${items(entry.items)})`).join(", ")} lists it, ticked.`
      : "";
  const nobody =
    unassigned > 0
      ? chasedTo.length > 0
        ? ` ${items(unassigned)} asking it ${unassigned === 1 ? "has" : "have"} no designer to ask — they are under "Nobody assigned" on the chase screen.`
        : ` No item asking it has a designer to ask, so no chase lists it yet — it is under "Nobody assigned" on the chase screen.`
      : "";
  return head + listed + nobody;
}
