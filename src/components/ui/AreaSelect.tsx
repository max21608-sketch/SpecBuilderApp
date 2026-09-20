// The area filter: a native select over whatever areas are loaded.
//
// ============================================================================
// WHY NOT A SEARCHABLE COMBOBOX
//
// The plan asks for the select to be "searchable at 40 areas" (§6.4). It is,
// and not by this control: both screens that mount it already carry a
// free-text search box that matches the area TEXT — the phase table's has
// always searched `record.area`, and the chase screen's was widened to do the
// same. So somebody with 35 areas types "dressing" and the list narrows,
// exactly as a combobox would, with no second keyboard model to learn and no
// custom listbox to keep accessible.
//
// A native `<select>` is therefore the whole control: it is one tab stop, it
// opens as the reader's own platform opens one, and on a phone it is the OS
// picker rather than a scrolling div.
// ============================================================================
import type { AreaOption } from "@/lib/area-filter";

export default function AreaSelect({
  options,
  value,
  onChange,
  className = "",
}: {
  options: readonly AreaOption[];
  /** The chosen key, or "" for every area. */
  value: string;
  onChange: (key: string) => void;
  /** Layout only. */
  className?: string;
}) {
  // The count beside "All areas" is the ROWS, not the number of areas: it is
  // what the list goes back to, and a reader comparing it with the option they
  // picked is comparing two counts of the same thing.
  const total = options.reduce((sum, option) => sum + option.count, 0);
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Filter by area"
      // An empty phase offers nothing to choose, and a select with one option
      // reading "All areas (0)" invites a click that does nothing.
      disabled={options.length === 0}
      className={`rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm ${className}`.trim()}
    >
      <option value="">All areas ({total})</option>
      {options.map((option) => (
        <option key={option.key} value={option.key}>
          {option.label} ({option.count})
        </option>
      ))}
    </select>
  );
}
