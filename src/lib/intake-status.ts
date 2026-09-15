// What an intake run's status is called on screen.
//
// ONE PLACE, because there were two and they had already drifted: `parsing`
// read "Being read" on the project overview and "Reading" on the pack screen,
// for the same row, one click apart. A status is part of the app's vocabulary
// and a reader should not have to work out that two words mean one state.
//
// `parsed` is "Ready to review" and `confirmed` is "Review complete" -- never
// just "Complete". Review being finished says every proposal was applied or
// ignored; whether the ANSWERS are settled is a different question, asked on
// the record screen.
export const INTAKE_STATUS_LABELS: Record<string, string> = {
  pending: "Not read yet",
  queued: "Queued",
  parsing: "Reading",
  parsed: "Ready to review",
  confirmed: "Review complete",
  failed: "Failed",
};

/** The label, or the raw status if the database grows one this does not know. */
export function intakeStatusLabel(status: string): string {
  return INTAKE_STATUS_LABELS[status] ?? status;
}

/**
 * In flight: something is going to change without anybody clicking, so the
 * screen showing it must poll and must not offer a Read button.
 */
export function isIntakeRunWorking(status: string): boolean {
  return status === "queued" || status === "parsing";
}
