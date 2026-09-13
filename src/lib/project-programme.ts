// The TOE key dates, and the one thing they are for: telling a record that is
// merely outstanding from one that is outstanding and late.
//
// Everything here is pure and works on ISO `YYYY-MM-DD` strings rather than
// `Date`. A TOE date is a calendar day, not an instant: parsing "2026-06-17"
// into a Date and comparing it to `now` makes the answer depend on the server's
// timezone, and a London-pinned deployment read from a browser in another one
// would disagree with itself about whether today is the deadline.
//
// OVERDUE IS COMPUTED, NEVER STORED -- the same reason Waiting is. Writing it
// onto spec_answers would bump the version that M2's extraction snapshots are
// taken against, for a reason that has nothing to do with the answer. See
// docs/plans/part-3 §7 and src/lib/chase-drafts.ts.

export type ProgrammeDates = {
  orderDate: string | null;
  specsAgreedBy: string | null;
  deliveryDate: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar day, not merely a well-shaped string. `2026-02-30` matches
 * the pattern and is not a date; Postgres would reject it, and a constraint
 * violation is a worse error message than this one.
 */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  );
}

/** The label for the date the programme is measured against. */
export const SPECS_AGREED_LABEL = "Complete specifications agreed by";

/**
 * The dates as an ordered set. An order date after a delivery date is a typo
 * worth refusing rather than storing: every downstream reading of it -- overdue
 * flags, a TOE calculation -- would be quietly wrong, and nothing would say so.
 *
 * Missing dates never fail. A partial programme is the normal state of a live
 * project: the order is placed long before a delivery date is agreed.
 */
export function validateProgramme(dates: ProgrammeDates): string | null {
  const entries: [string, string | null][] = [
    ["The order date", dates.orderDate],
    [SPECS_AGREED_LABEL, dates.specsAgreedBy],
    ["The delivery date", dates.deliveryDate],
  ];
  for (const [label, value] of entries) {
    if (value !== null && !isCalendarDate(value)) return `${label} is not a real date.`;
  }
  const { orderDate, specsAgreedBy, deliveryDate } = dates;
  if (orderDate && deliveryDate && orderDate > deliveryDate) {
    return "The order date is after the delivery date. Check which is which.";
  }
  if (orderDate && specsAgreedBy && orderDate > specsAgreedBy) {
    return `The order date is after the date specifications must be agreed. Check which is which.`;
  }
  if (specsAgreedBy && deliveryDate && specsAgreedBy > deliveryDate) {
    return `${SPECS_AGREED_LABEL} is after the delivery date. Check which is which.`;
  }
  return null;
}

/**
 * The spec table's four states, in the order the design requirements name them.
 *
 *   complete         nothing outstanding
 *   waiting          every outstanding question has been chased (M4)
 *   action_required  something outstanding has not been asked
 *   overdue          either of the last two, past the specs-agreed date
 */
export type RecordUrgency = "complete" | "waiting" | "action_required" | "overdue";

/**
 * `today` is passed in, never read from the clock, so a test can state the day
 * it means. Callers give it as a local `YYYY-MM-DD`.
 *
 * A NULL `specsAgreedBy` means "no programme", NOT "not overdue". Nothing here
 * distinguishes the two -- that is the screen's job, and `hasProgramme` below
 * is what it reads. Rendering everything as on-time because nobody entered a
 * date is the same class of error as a category with no requirements scoring
 * 0/0 and reading as complete.
 */
export function recordUrgency(input: {
  outstanding: number;
  allChased: boolean;
  specsAgreedBy: string | null;
  today: string;
}): RecordUrgency {
  if (input.outstanding === 0) return "complete";
  if (input.specsAgreedBy && input.specsAgreedBy < input.today) return "overdue";
  return input.allChased ? "waiting" : "action_required";
}

export const URGENCY_LABELS: Record<RecordUrgency, string> = {
  complete: "Complete",
  waiting: "Waiting for a reply",
  action_required: "Action required",
  overdue: "Overdue",
};

/** Whether any date at all has been entered. See the note on `recordUrgency`. */
export function hasProgramme(dates: ProgrammeDates): boolean {
  return Boolean(dates.orderDate || dates.specsAgreedBy || dates.deliveryDate);
}

/** Days until the specs-agreed date; negative once it has passed. Null if unset. */
export function daysUntilSpecsAgreed(specsAgreedBy: string | null, today: string): number | null {
  if (!specsAgreedBy || !isCalendarDate(specsAgreedBy) || !isCalendarDate(today)) return null;
  const day = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${specsAgreedBy}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / day);
}

/** Today as a local calendar day, which is what the dates on screen mean. */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
