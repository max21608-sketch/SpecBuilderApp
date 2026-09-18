/**
 * A calendar day as a person writes it — `14 Oct 2026`, never `2026-10-14`.
 *
 * Built from the STRING's own parts, never from a `Date`. These are `date`
 * columns; both drivers parse one into local midnight and any date maths on it
 * renders the day before in British Summer Time. The TOE-dates rule, applied
 * to formatting rather than to comparison.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

export function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  const index = Number(month) - 1;
  if (!year || !date || Number.isNaN(index) || !MONTHS[index]) return day;
  return `${Number(date)} ${MONTHS[index]} ${year}`;
}
