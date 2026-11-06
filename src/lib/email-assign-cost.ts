// What putting a held email on a project will cost, said BEFORE the click.
//
// Assignment is the spend point, and since audit A1 it is not always the same
// spend. A message taken off a project keeps the run that project read, so
// putting it back there re-links that run and reads nothing; putting it on any
// other project is a new run and a new charged read, because that project has
// never seen it. A button that said "one charged model call" for both would be
// wrong half the time, in the direction that teaches people to ignore it.
//
// A leaf, so the inbox (a client component) and its test can both read it
// without pulling in the database driver.

export type AssignCost = {
  /** True when the chosen project already has this message's run. */
  free: boolean;
  /** The words under the button. */
  sentence: string;
  /** The button's own label. */
  label: string;
};

/**
 * `readOn` is every project a run for this message exists on (the inbox
 * route's `read_on`); `chosen` the project picked in the select, if any.
 */
export function assignCost(
  readOn: readonly string[] | null | undefined,
  chosen: { id: string; bws_project_number: string } | null,
): AssignCost {
  const previously = readOn ?? [];
  if (chosen && previously.includes(chosen.id)) {
    return {
      free: true,
      label: "Put it back",
      sentence: `Already read on ${chosen.bws_project_number}: putting it back there reads nothing.`,
    };
  }
  if (chosen && previously.length > 0) {
    return {
      free: false,
      label: "Assign & read",
      sentence: `Reading it again on ${chosen.bws_project_number} is a charged read.`,
    };
  }
  return { free: false, label: "Assign & read", sentence: "One charged model call." };
}
